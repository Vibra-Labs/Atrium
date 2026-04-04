import { IsString, IsUrl, MaxLength, MinLength } from "class-validator";

const urlOptions = {
  protocols: ["https", "http"],
  require_protocol: true,
  require_tld: false,
};

export class CreateCheckoutDto {
  @IsString()
  @IsUrl(urlOptions, { message: "successUrl must be a valid HTTP(S) URL" })
  successUrl!: string;

  @IsString()
  @IsUrl(urlOptions, { message: "cancelUrl must be a valid HTTP(S) URL" })
  cancelUrl!: string;
}

export class ConnectAuthorizeDto {
  @IsString()
  @IsUrl(urlOptions, { message: "returnUrl must be a valid HTTP(S) URL" })
  returnUrl!: string;
}

export class SaveDirectKeysDto {
  @IsString()
  @MinLength(20)
  @MaxLength(500)
  stripeSecretKey!: string;
}
