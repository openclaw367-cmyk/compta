import { Module } from '@nestjs/common';
import { EntriesModule } from '../entries/entries.module';
import { McpConfirmationsController } from './mcp-confirmations.controller';
import { McpConfirmationsService } from './mcp-confirmations.service';

@Module({
  imports: [EntriesModule],
  controllers: [McpConfirmationsController],
  providers: [McpConfirmationsService],
  exports: [McpConfirmationsService],
})
export class McpConfirmationsModule {}
