import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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
  // exposedHeaders is required for the FEC export endpoints: browsers only
  // expose a CORS-safelisted header set to JS by default, and
  // Content-Disposition (which carries the server-assigned filename,
  // e.g. "123456789FEC20261231.txt") isn't in that safelist.
  app.enableCors({ exposedHeaders: ['Content-Disposition'] });

  // Mounted at /docs, not /api — /api is reserved for a future global route
  // prefix, and colliding with it would mean either the prefix or the
  // Swagger UI silently loses. SwaggerModule.setup registers its routes
  // directly on the underlying HTTP adapter rather than as a Nest
  // controller, so it never goes through CompanyContextMiddleware — see
  // app.module.ts "configure" for why that middleware is applied to an
  // explicit controller allowlist instead of a wildcard.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('compta-fr-mc API')
    .setDescription(
      'French/Monaco double-entry accounting suite: PCG chart of accounts, ' +
        'FEC export (Article A47 A-1 du LPF), Excel journal import, ' +
        'depreciation, VAT, liasse. Every endpoint below except ' +
        '"POST /companies" is scoped to a tenant resolved from the ' +
        '"x-company-id" header (falls back to the single existing company ' +
        'if omitted). See CLAUDE.md for the compliance rules this API enforces.',
    )
    .setVersion('0.1.0')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
