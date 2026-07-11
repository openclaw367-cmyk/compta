import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Journal, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { CreateJournalDto } from './dto/create-journal.dto';

const PRISMA_UNIQUE_CONSTRAINT_ERROR = 'P2002';

@Injectable()
export class JournalsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(company: CompanyContext, dto: CreateJournalDto): Promise<Journal> {
    try {
      return await this.prisma.journal.create({
        data: { companyId: company.companyId, ...dto },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR) {
          throw new ConflictException(`Journal code "${dto.code}" already exists.`);
        }
      }
      throw error;
    }
  }

  findAll(company: CompanyContext): Promise<Journal[]> {
    return this.prisma.journal.findMany({
      where: { companyId: company.companyId },
      orderBy: { code: 'asc' },
    });
  }

  async findOne(company: CompanyContext, id: string): Promise<Journal> {
    const journal = await this.prisma.journal.findFirst({
      where: { id, companyId: company.companyId },
    });
    if (!journal) {
      throw new NotFoundException(`Journal ${id} not found`);
    }
    return journal;
  }
}
