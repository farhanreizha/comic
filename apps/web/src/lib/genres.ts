import { m } from "$paraglide/messages.js";

/** The 12-value enum stays code, not a table (AGENTS.md). Mirrors the
 *  genre union in @comic/reading — web reads it through the oRPC client. */
export type Genre =
	| "action"
	| "adventure"
	| "comedy"
	| "drama"
	| "fantasy"
	| "horror"
	| "mystery"
	| "romance"
	| "sci-fi"
	| "slice-of-life"
	| "sports"
	| "thriller";

export const GENRES: readonly Genre[] = [
	"action",
	"adventure",
	"comedy",
	"drama",
	"fantasy",
	"horror",
	"mystery",
	"romance",
	"sci-fi",
	"slice-of-life",
	"sports",
	"thriller",
] as const;

const GENRE_MESSAGE: Record<Genre, () => string> = {
	action: m.genre_action,
	adventure: m.genre_adventure,
	comedy: m.genre_comedy,
	drama: m.genre_drama,
	fantasy: m.genre_fantasy,
	horror: m.genre_horror,
	mystery: m.genre_mystery,
	romance: m.genre_romance,
	"sci-fi": m.genre_sci_fi,
	"slice-of-life": m.genre_slice_of_life,
	sports: m.genre_sports,
	thriller: m.genre_thriller,
};

export const genreLabel = (genre: Genre): string => GENRE_MESSAGE[genre]();
