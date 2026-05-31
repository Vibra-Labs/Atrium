import { Transform, Type } from "class-transformer";
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  ArrayUnique,
  ValidateNested,
  ValidateIf,
  IsIn,
  IsDateString,
  MaxLength,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from "class-validator";
import { PaginationQueryDto } from "../common";

function AtLeastOneOf(properties: string[], validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "atLeastOneOf",
      target: object.constructor,
      propertyName,
      constraints: properties,
      options: validationOptions,
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          const props = args.constraints as string[];
          const dto = args.object as Record<string, unknown>;
          return props.some((prop) => dto[prop] !== undefined && dto[prop] !== null && dto[prop] !== "");
        },
        defaultMessage(args: ValidationArguments) {
          const props = args.constraints as string[];
          return `At least one of ${props.join(" or ")} must be provided`;
        },
      },
    });
  };
}

export class LineItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsInt()
  @Min(0)
  unitPrice!: number;
}

export class CreateInvoiceDto {
  @IsString()
  @IsOptional()
  projectId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  lineItems!: LineItemDto[];

  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateInvoiceDto {
  @IsString()
  @IsOptional()
  @IsIn(["draft", "sent", "paid", "overdue", "cancelled"])
  status?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  @IsOptional()
  lineItems?: LineItemDto[];

  @ValidateIf((o) => o.dueDate !== null)
  @IsDateString()
  @IsOptional()
  dueDate?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;
}

export class CreateUploadedInvoiceDto {
  @IsString()
  @IsOptional()
  projectId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount!: number;

  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;
}

export class RecordInvoiceDto {
  @IsString()
  @IsOptional()
  billingClientId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  externalReference!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(250)
  @ArrayUnique()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string") return value;
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Fall through to comma-separated support for multipart form fields.
    }
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  })
  timeEntryIds!: string[];

  @IsString()
  @IsOptional()
  projectId?: string;

  @AtLeastOneOf(["projectId", "billingClientId"], {
    message: "Either projectId or billingClientId must be provided",
  })
  readonly invoiceScope?: never;

  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;
}

export class MineInvoiceQueryDto extends PaginationQueryDto {
  @IsString()
  @IsOptional()
  projectId?: string;
}

export class InvoiceListQueryDto extends PaginationQueryDto {
  @IsString()
  @IsOptional()
  projectId?: string;

  @IsString()
  @IsOptional()
  @IsIn(["draft", "sent", "paid", "overdue", "cancelled"])
  status?: string;
}
