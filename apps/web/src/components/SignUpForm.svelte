<script lang="ts">
import { createForm } from "@tanstack/svelte-form";
import { z } from "zod";
import { goto } from "$app/navigation";
import { authClient } from "$lib/auth-client";
import { Button, Input } from "$components/ui";
import { m } from "$paraglide/messages.js";

let { switchToSignIn } = $props<{ switchToSignIn: () => void }>();

const validationSchema = z.object({
	name: z.string().min(2, m.auth_name_min()),
	email: z.email(m.auth_invalid_email()),
	password: z.string().min(8, m.auth_password_min()),
});

const form = createForm(() => ({
	defaultValues: { name: "", email: "", password: "" },
	onSubmit: async ({ value }) => {
		await authClient.signUp.email(
			{
				email: value.email,
				password: value.password,
				name: value.name,
			},
			{
				onSuccess: () => {
					goto("/library");
				},
				onError: (error) => {
					console.log(error.error.message || m.error_generic());
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
	<h1 class="mb-6 text-center font-bold text-3xl">{m.auth_signup_title()}</h1>

	<form
		id="form"
		class="space-y-4"
		onsubmit={(e) => {
			e.preventDefault();
			e.stopPropagation();
			form.handleSubmit();
		}}
	>
		<form.Field name="name">
			{#snippet children(field)}
				<Input
					id={field.name}
					name={field.name}
					label={m.auth_name()}
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
					{state.isSubmitting ? m.auth_submitting() : m.auth_signup_button()}
				</Button>
			{/snippet}
		</form.Subscribe>
	</form>

	<div class="mt-4 text-center">
		<button type="button" class="text-accent hover:text-accent-dk" onclick={switchToSignIn}>
			{m.auth_have_account()} · {m.auth_signin_button()}
		</button>
	</div>
</div>
