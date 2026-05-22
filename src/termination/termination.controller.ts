import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { Form161TransitionInput } from './form-161-lifecycle.service';
import { TerminationTransitionInput } from './termination-lifecycle.service';
import { TerminationService } from './termination.service';
import { NewForm161 } from './termination.types';

@Controller()
@Roles('OPERATOR', 'MANAGER')
export class TerminationController {
  constructor(private readonly term: TerminationService) {}

  @Post('terminations/scan')
  scan() {
    return this.term.scan();
  }

  @Post('terminations/:id/transition')
  transition(@Param('id') id: string, @Body() body: TerminationTransitionInput) {
    return this.term.transition(id, body);
  }

  @Post('terminations/:id/forms-161')
  createForm(@Param('id') id: string, @Body() body: Omit<NewForm161, 'terminationEventId'>) {
    return this.term.createForm({ ...body, terminationEventId: id });
  }

  @Post('forms-161/:id/transition')
  transitionForm(@Param('id') id: string, @Body() body: Form161TransitionInput) {
    return this.term.transitionForm(id, body);
  }
}
