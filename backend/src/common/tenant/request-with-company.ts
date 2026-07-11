import { Request } from 'express';
import { CompanyContext } from './company-context';

export interface RequestWithCompany extends Request {
  companyContext: CompanyContext;
}
