import { PrismaClient } from "@prisma/client";

// Single shared instance across the app (avoids exhausting Postgres
// connections when the module is re-imported, e.g. under tsx watch reloads).
export const prisma = new PrismaClient();
