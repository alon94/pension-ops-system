import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { A8DocumentUnderstandingAgent, DocumentExtractionPayload } from './a8.document-understanding';
import { randomUUID } from 'node:crypto';

@Controller('agents')
export class AgentsController {
  constructor(private readonly a8: A8DocumentUnderstandingAgent) {}

  /**
   * §11.2 A8 + §8.4 — חילוץ שדות מטופס 161 סרוק.
   * הקלט: contentBase64 + mediaType. הפלט: שדות חולצו + אילוצים שלא מתקיימים.
   * אדם בלבד יוצר את הטופס בפועל (POST /terminations/:id/forms-161) אחרי אישור.
   */
  @Post('a8/extract-form-161')
  @Roles('OPERATOR', 'MANAGER')
  async extractForm161(@Body() body: DocumentExtractionPayload) {
    if (!body?.contentBase64 || !body?.mediaType) {
      throw new BadRequestException('contentBase64 ו-mediaType נדרשים');
    }
    return this.a8.run({
      taskId: randomUUID(),
      agent: 'A8',
      trigger: 'MANUAL',
      reason: 'extract-form-161',
      payload: body,
      enqueuedAt: new Date().toISOString(),
    });
  }
}
