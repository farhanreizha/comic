<script lang="ts">
import { createForm } from "@tanstack/svelte-form";
import { z } from "zod";
import { goto } from "$app/navigation";
import { Button, Input } from "$components/ui";
import { authClient } from "$lib/auth-client";
import { mapWriteError } from "$lib/write-ui";
import { m } from "$paraglide/messages.js";

let { switchToSignUp } = $props<{ switchToSignUp: () => void }>();

// Better-auth answers a specific `message` ("Invalid email or password");
// only an error with none falls back to generic (H10: no dead-end messages).
const formError = $state({ msg: "" });

const validationSchema = z.object({
	email: z.email(m.auth_invalid_email()),
	password: z.string().min(1, m.auth_password_required()),
});

const form = createForm(() => ({
	defaultValues: { email: "", password: "" },
	onSubmit: async ({ value }) => {
		formError.msg = "";
		await authClient.signIn.email(
			{ email: value.email, password: value.password },
			{
				onSuccess: () => goto("/library"),
				onError: (error) => {
					formError.msg = mapWriteError(error.error).message;
				},
			},
		);
	},
	validators: {
		onSubmit: validationSchema,
	},
}));

type SubmitState = Pick<typeof form.state, "canSubmit" | "isSubmitting">;
</script>

<div class="mx-auto mt-10 w-full max-w-md p-6">
	<h1 class="mb-6 text-center font-bold text-3xl">{m.auth_signin_title()}</h1>

	<form
		class="space-y-4"
		onsubmit={(e) => {
			e.preventDefault();
			e.stopPropagation();
			form.handleSubmit();
		}}
	>
		<form.Field name="email">
			{#snippet children(field)}
				<Input
					id={field.name}
					name={field.name}
					type="email"
					label={m.auth_email()}
					onblur={field.handleBlur}
					value={field.state.value}
					oninput={(e: Event) => {
						const target = e.target as HTMLInputElement;
						field.handleChange(target.value);
					}}
					error={field.state.meta.isTouched ? field.state.meta.errors.join(", ") : undefined}
				/>
			{/snippet}
		</form.Field>

		<form.Field name="password">
			{#snippet children(field)}
				<Input
					id={field.name}
					name={field.name}
					type="password"
					label={m.auth_password()}
					onblur={field.handleBlur}
					value={field.state.value}
					oninput={(e: Event) => {
						const target = e.target as HTMLInputElement;
						field.handleChange(target.value);
					}}
					error={field.state.meta.isTouched ? field.state.meta.errors.join(", ") : undefined}
				/>
			{/snippet}
		</form.Field>

		<form.Subscribe selector={(state: typeof form.state): SubmitState => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
			{#snippet children(state: SubmitState)}
				<Button type="submit" class="w-full" disabled={!state.canSubmit || state.isSubmitting}>
					{state.isSubmitting ? m.auth_submitting() : m.auth_signin_button()}
				</Button>
			{/snippet}
		</form.Subscribe>
		{#if formError.msg}
			<p class="text-sm text-accent" role="alert">{formError.msg}</p>
		{/if}
	</form>

	<div class="mt-4 text-center">
		<button type="button" class="text-accent hover:text-accent-dk" onclick={switchToSignUp}>
			{m.auth_no_account()} · {m.auth_signup_button()}
		</button>
	</div>
</div>
