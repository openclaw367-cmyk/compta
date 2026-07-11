import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

const MONEY_STRING_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * class-validator decorator for monetary DTO fields. Deliberately rejects
 * `number` — money crosses the API boundary as a string (e.g. "1234.56")
 * and is parsed with `Money.fromString`, never `@IsNumber()`. See
 * CLAUDE.md "Money handling".
 */
export function IsMoneyString(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isMoneyString',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && MONEY_STRING_PATTERN.test(value);
        },
        defaultMessage(args: ValidationArguments): string {
          return (
            `${args.property} must be a monetary amount encoded as a string with up to ` +
            `2 decimal places (e.g. "1234.56"), not a number`
          );
        },
      },
    });
  };
}
