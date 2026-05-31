import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from "class-validator";
import { Type } from "class-transformer";

function ExactlyOneOf(properties: string[], validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "exactlyOneOf",
      target: object.constructor,
      propertyName,
      constraints: properties,
      options: validationOptions,
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          const props = args.constraints as string[];
          const dto = args.object as Record<string, unknown>;
          return props.filter((prop) => dto[prop] !== undefined && dto[prop] !== null && dto[prop] !== "").length === 1;
        },
        defaultMessage(args: ValidationArguments) {
          const props = args.constraints as string[];
          return `Exactly one of ${props.join(" or ")} must be provided`;
        },
      },
    });
  };
}

export class StartTimerDto {
  @IsString() projectId!: string;
  @IsOptional() @IsString() taskId?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class CreateManualEntryDto {
  @IsString() projectId!: string;
  @IsOptional() @IsString() taskId?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsDateString() startedAt!: string;
  @IsDateString() endedAt!: string;
  @IsOptional() @IsBoolean() billable?: boolean;
}

export class UpdateTimeEntryDto {
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsDateString() startedAt?: string;
  @IsOptional() @IsDateString() endedAt?: string;
  @IsOptional() @IsBoolean() billable?: boolean;
  @IsOptional() @IsString() taskId?: string | null;
}

export class TimeEntryListQueryDto {
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() billingClientId?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() billable?: "true" | "false";
  @IsOptional() invoiced?: "true" | "false";
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;
}

export class GenerateInvoiceDto {
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() billingClientId?: string;
  @ExactlyOneOf(["projectId", "billingClientId"], {
    message: "Exactly one of projectId or billingClientId must be provided",
  })
  readonly invoiceScope?: never;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsBoolean() includeNonBillable?: boolean;
  @IsOptional() @IsBoolean() mergeEntries?: boolean;
}
