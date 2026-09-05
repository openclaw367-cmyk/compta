import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module';
import { MailerModule } from '../mailer/mailer.module';
import { ActivityModule } from '../activity/activity.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [CompaniesModule, MailerModule, ActivityModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
