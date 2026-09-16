import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ data }) => {
	redirect(302, data.role === "admin" ? "/dashboard/admin" : "/dashboard/comics");
};
