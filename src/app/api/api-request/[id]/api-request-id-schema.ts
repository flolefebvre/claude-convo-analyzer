import z from "zod";

/** An `api_request` row id, as the `[id]` segment spells it. */
export const apiRequestIdSchema = z.coerce.number().int().positive().max(2_147_483_647); // Prisma reads an `Int` id as 32-bit
