import { BadRequestException, Body, Controller, Param, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { IngestionService } from './ingestion.service';

interface IngestBody {
  sourceFileName: string;
  /** תוכן הקובץ כ-base64 (XML או Fixed-Width) */
  contentBase64: string;
  source?: string;
}

/** API חיצוני מינימלי להזרקת קובץ מבנה אחיד (SFTP/קליטה ידנית). */
@Controller('ingestion')
@Roles('OPERATOR', 'MANAGER')
export class IngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  @Post('files')
  async ingest(@Body() body: IngestBody) {
    if (!body?.contentBase64 || !body?.sourceFileName) {
      throw new BadRequestException('sourceFileName ו-contentBase64 נדרשים');
    }
    return this.ingestion.ingest({
      sourceFileName: body.sourceFileName,
      content: Buffer.from(body.contentBase64, 'base64'),
      source: body.source,
    });
  }

  @Post('runs/:id/rollback')
  async rollback(@Param('id') id: string) {
    await this.ingestion.rollback(id);
    return { status: 'rolled_back', ingestionRunId: id };
  }
}
