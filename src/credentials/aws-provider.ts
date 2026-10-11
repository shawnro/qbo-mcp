// AWS-based credential provider using Secrets Manager and SSM Parameter Store

import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { parseCredentialJson, parseCredentialPayload } from "./types.js";
import type { CredentialProvider, QBCredentials } from "./types.js";

export interface AWSCredentialProviderOptions {
  region?: string;
  secretName?: string;
  companyIdParameter?: string;
  secretsClient?: SecretsManagerClient;
  ssmClient?: SSMClient;
}

/**
 * AWS-based credential provider
 * Stores credentials in Secrets Manager and company ID in SSM Parameter Store
 */
export class AWSCredentialProvider implements CredentialProvider {
  private secretsClient: SecretsManagerClient;
  private ssmClient: SSMClient;
  private cachedCompanyId: string | null = null;
  private readonly region: string;
  private readonly secretName: string;
  private readonly companyIdParameter: string;

  constructor(options: AWSCredentialProviderOptions = {}) {
    const region = options.region ?? process.env.AWS_REGION ?? "us-east-2";
    this.region = region;
    this.secretName = options.secretName ?? process.env.QBO_SECRET_NAME ?? "prod/qbo";
    this.companyIdParameter = options.companyIdParameter
      ?? process.env.QBO_COMPANY_ID_PARAM
      ?? "/prod/qbo/company_id";
    this.secretsClient = options.secretsClient ?? new SecretsManagerClient({ region });
    this.ssmClient = options.ssmClient ?? new SSMClient({ region });
  }

  getRefreshLockScope(): string {
    return `aws:${this.region.toLowerCase()}:${this.secretName}`;
  }

  async getCredentials(): Promise<QBCredentials> {
    const command = new GetSecretValueCommand({ SecretId: this.secretName });
    const response = await this.secretsClient.send(command);

    if (!response.SecretString) {
      throw new Error("Secret value is empty");
    }

    return parseCredentialJson(
      response.SecretString,
      `AWS Secrets Manager secret "${this.secretName}"`
    );
  }

  async saveCredentials(credentials: QBCredentials): Promise<void> {
    const validated = parseCredentialPayload(credentials, "QuickBooks credentials to save");
    const command = new PutSecretValueCommand({
      SecretId: this.secretName,
      SecretString: JSON.stringify(validated),
    });
    await this.secretsClient.send(command);
  }

  async getCompanyId(): Promise<string> {
    if (this.cachedCompanyId) {
      return this.cachedCompanyId;
    }

    const command = new GetParameterCommand({
      Name: this.companyIdParameter,
      WithDecryption: true,
    });
    const response = await this.ssmClient.send(command);

    if (!response.Parameter?.Value) {
      throw new Error("Company ID parameter not found");
    }

    this.cachedCompanyId = response.Parameter.Value;
    return this.cachedCompanyId;
  }

  async isConfigured(): Promise<boolean> {
    try {
      await this.getCredentials();
      await this.getCompanyId();
      return true;
    } catch (error) {
      if (isAwsMissingResourceError(error)) return false;
      throw error;
    }
  }
}

function isAwsMissingResourceError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? (error as { name?: unknown }).name : undefined;
  return name === "ResourceNotFoundException" || name === "ParameterNotFound";
}
