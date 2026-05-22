import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Vault — אחסון מאובטח של הקובץ הגולמי (§5.2).
 * בפיתוח: תיקייה מקומית. בפרודקשן: S3 encrypted bucket (החלפת המימוש בלבד).
 */
@Injectable()
export class VaultService {
  private readonly dir: string;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.dir = config.get<string>('vaultDir') ?? './vault';
  }

  async store(fileHash: string, sourceFileName: string, content: Buffer): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const path = join(this.dir, `${fileHash}__${sourceFileName}`);
    await writeFile(path, content);
    return path;
  }
}
