// AWS-based credential provider using Secrets Manager and SSM Parameter Store

import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import type { CredentialProvider, QBCredentials } from "./types.js";

export interface AWSCredentialProviderOptions {
  region?: string;
  secretName?: string;
  companyIdParameter?: string;
}

/**
 * AWS-based credential provider
 * Stores credentials in Secrets Manager and company ID in SSM Parameter Store
 */
export class AWSCredentialProvider implements CredentialProvider {
  private secretsClient: SecretsManagerClient;
  private ssmClient: SSMClient;
  private cachedCompanyId: string | null = null;
  private readonly secretName: string;
  private readonly companyIdParameter: string;

  constructor(options: AWSCredentialProviderOptions = {}) {
    const region = options.region ?? process.env.AWS_REGION ?? "us-east-2";
    this.secretName = options.secretName ?? process.env.QBO_SECRET_NAME ?? "prod/qbo";
    this.companyIdParameter = options.companyIdParameter
      ?? process.env.QBO_COMPANY_ID_PARAM
      ?? "/prod/qbo/company_id";
    this.secretsClient = new SecretsManagerClient({ region });
    this.ssmClient = new SSMClient({ region });
  }

  async getCredentials(): Promise<QBCredentials> {
    const command = new GetSecretValueCommand({ SecretId: this.secretName });
    const response = await this.secretsClient.send(command);

    if (!response.SecretString) {
      throw new Error("Secret value is empty");
    }

    return JSON.parse(response.SecretString) as QBCredentials;
  }

  async saveCredentials(credentials: QBCredentials): Promise<void> {
    const command = new PutSecretValueCommand({
      SecretId: this.secretName,
      SecretString: JSON.stringify(credentials),
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
    } catch {
      return false;
    }
  }
}

// Legacy exports for backward compatibility with src/aws.ts re-exports
export async function getSecret(): Promise<QBCredentials> {
  const provider = new AWSCredentialProvider();
  return provider.getCredentials();
}

export async function putSecret(credentials: QBCredentials): Promise<void> {
  const provider = new AWSCredentialProvider();
  return provider.saveCredentials(credentials);
}

export async function getCompanyId(): Promise<string> {
  const provider = new AWSCredentialProvider();
  return provider.getCompanyId();
}
