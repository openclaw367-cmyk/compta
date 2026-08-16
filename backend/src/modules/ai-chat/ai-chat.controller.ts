import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
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
      'Send a message in a session; runs the read-tool-calling loop and returns the new messages.',
    description:
      'Phase 1: read-only. The model may call any of the registered query_*/list_*/search_* ' +
      'tools, never write anything — no write tool is registered in this version. Returns every ' +
      'message the turn produced (the user message, any tool calls, their results, and the ' +
      "final answer) in order, so the caller doesn't need a refetch.",
  })
  @Post('sessions/:id/messages')
  sendMessage(
    @CurrentCompany() company: CompanyContext,
    @Param('id') id: string,
    @Body() dto: SendChatMessageDto,
  ) {
    return this.aiChatService.sendMessage(company, id, dto.content);
  }
}
