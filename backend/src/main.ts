import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  // Required to read the httpOnly refresh-token cookie (see CLAUDE.md
  // "Multi-user / roles & permissions") — AuthController reads
  // req.cookies directly, no other part of this app uses cookies.
  app.use(cookieParser());
  // exposedHeaders is required for the FEC export endpoints: browsers only
  // expose a CORS-safelisted header set to JS by default, and
  // Content-Disposition (which carries the server-assigned filename,
  // e.g. "123456789FEC20261231.txt") isn't in that safelist.
  //
  // origin/credentials moved from a wildcard to an explicit origin once
  // the refresh-token cookie shipped: the CORS spec forbids a wildcard
  // origin together with credentials:true (browsers reject it outright),
  // and credentials:true is required for the browser to actually send
  // that cookie cross-origin (Vite dev on :5173, the API on :3000).
  // FRONTEND_ORIGIN defaults to the Vite dev server's own default port.
  app.enableCors({
    origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  });

  // Mounted at /docs, not /api — /api is reserved for a future global route
  // prefix, and colliding with it would mean either the prefix or the
  // Swagger UI silently loses. SwaggerModule.setup registers its routes
  // directly on the underlying HTTP adapter rather than as a Nest
  // controller, so it never goes through CompanyContextMiddleware — see
  // app.module.ts "configure" for why that middleware is applied to an
  // explicit controller allowlist instead of a wildcard.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Citaledge API')
    .setDescription(
      'French/Monaco double-entry accounting suite: PCG chart of accounts, ' +
        'FEC export (Article A47 A-1 du LPF), Excel journal import, ' +
        'depreciation, VAT, liasse. Every endpoint except "/auth/*" requires ' +
        'an "Authorization: Bearer <token>" access token (see POST ' +
        '/auth/login). Every endpoint except "/auth/*", "POST /companies", ' +
        '"GET /companies", and "GET /backup/export" (a full-instance ' +
        'backup spanning every company, see CLAUDE.md "Operational ' +
        'readiness") additionally requires an "x-company-id" header ' +
        'naming a company the caller is a member of. See CLAUDE.md for ' +
        'the compliance rules this API enforces.',
    )
    .addBearerAuth()
    .setVersion('0.1.0')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
