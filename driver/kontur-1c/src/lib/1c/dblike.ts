import { db as prisma } from '../db'
import type { Prisma, PrismaClient } from '@prisma/client'

type Tx = Prisma.TransactionClient | PrismaClient

export { prisma }
export type DbLike = typeof prisma
