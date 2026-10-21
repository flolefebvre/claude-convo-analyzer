import z from "zod";

/** A `logged_api_request` row id, as the `[id]` segment spells it. */
export const loggedApiRequestIdSchema = z.coerce.number().int().positive().max(2_147_483_647); // Prisma reads an `Int` id as 32-bit
