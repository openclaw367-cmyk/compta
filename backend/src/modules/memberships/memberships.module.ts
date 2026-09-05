import { Module } from '@nestjs/common';
import { MailerModule } from '../mailer/mailer.module';
import { ActivityModule } from '../activity/activity.module';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';

@Module({
  imports: [MailerModule, ActivityModule],
  controllers: [MembershipsController],
  providers: [MembershipsService],
})
export class MembershipsModule {}
