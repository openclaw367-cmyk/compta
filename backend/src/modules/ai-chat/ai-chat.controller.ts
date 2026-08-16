import { Body, Controller, Get, Param, Post, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { AiChatService } from './ai-chat.service';
import { SendChatMessageDto } from './dto/send-chat-message.dto';

@ApiTags('ai-chat')
@ApiHeader({
  name: 'x-company-id',
  required: false,
  description: 'Tenant id. Falls back to the single existing company if omitted.',
})
@Controller('ai-chat')
export class AiChatController {
  constructor(private readonly aiChatService: AiChatService) {}

  @ApiOperation({
    summary: 'Whether a local model is reachable and loaded right now.',
    description:
      'Cheap, side-effect-free. The chat UI polls this to show a clean degraded state instead ' +
      'of a raw connection error when no local model is running.',
  })
  @Get('availability')
  availability() {
    return this.aiChatService.availability();
  }

  @ApiOperation({ summary: 'Start a new chat session.' })
  @Post('sessions')
  createSession(@CurrentCompany() company: CompanyContext) {
    return this.aiChatService.createSession(company);
  }

  @ApiOperation({ summary: "List this company's chat sessions, most recently updated first." })
  @Get('sessions')
  listSessions(@CurrentCompany() company: CompanyContext) {
    return this.aiChatService.listSessions(company);
  }

  @ApiOperation({ summary: 'One chat session with its full message history.' })
  @Get('sessions/:id')
  getSession(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.aiChatService.getSession(company, id);
  }

  @ApiOperation({
    summary:
      'Send a message (optionally with attached invoice files) in a session; runs the ' +
      'tool-calling loop and returns the new messages.',
    description:
      'The model has read tools plus propose_ecriture (never persists by itself — see ' +
      'CLAUDE.md "AI chatbot Phase 2"). Attached PDF/Excel files (memory-storage only, never ' +
      'written to disk, scoped strictly to this request — see invoice-extraction.service.ts) ' +
      'are parsed DETERMINISTICALLY before the model turn starts; the parsed facts are injected ' +
      'as an automatic extract_invoice_facts trace, visible the same way any other tool result ' +
      "is. Returns every message the turn produced in order, so the caller doesn't need a refetch.",
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'Optional invoice PDF/Excel attachments.',
        },
      },
      required: ['content'],
    },
  })
  @Post('sessions/:id/messages')
  @UseInterceptors(FilesInterceptor('files'))
  sendMessage(
    @CurrentCompany() company: CompanyContext,
    @Param('id') id: string,
    @Body() dto: SendChatMessageDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.aiChatService.sendMessage(company, id, dto.content, files ?? []);
  }
}
