import { Injectable } from '@nestjs/common';
import { Form161, Form161Status } from './termination.types';
import { Form161Issue, validateForm161 } from './form-161-rules';

/** §8.4 — מעברי מצב של טופס 161. */
export const FORM161_TRANSITIONS: Record<Form161Status, Form161Status[]> = {
  DRAFT: ['SIGNED', 'REJECTED'],
  SIGNED: ['VERIFIED', 'REJECTED'],
  VERIFIED: ['SUBMITTED', 'REJECTED'],
  SUBMITTED: [],                     // טרמינלי
  REJECTED: ['DRAFT'],               // תיקון וחזרה
};

export class Form161TransitionError extends Error {
  constructor(public readonly issues: Form161Issue[], public readonly from: Form161Status, public readonly to: Form161Status) {
    super(`מעבר אסור ${from} → ${to}: ${issues.map((i) => i.code).join(', ') || 'מעבר לא חוקי'}`);
  }
}

export interface Form161TransitionInput {
  to: Form161Status;
  by: string;
  reason?: string; // נדרש ל-REJECTED
}

@Injectable()
export class Form161LifecycleService {
  canTransition(from: Form161Status, to: Form161Status): boolean {
    return FORM161_TRANSITIONS[from]?.includes(to) ?? false;
  }

  applyTransition(form: Form161, input: Form161TransitionInput): Form161 {
    if (!this.canTransition(form.validationStatus, input.to)) {
      throw new Form161TransitionError([], form.validationStatus, input.to);
    }

    // מעבר ל-SIGNED/VERIFIED חייב לעבור את כל אילוצי §8.4.
    if (input.to === 'SIGNED' || input.to === 'VERIFIED') {
      const issues = validateForm161(form);
      // ל-SIGNED נדרשת לפחות חתימת מעסיק; ל-VERIFIED נדרש שכל החתימות הרלוונטיות יוטבעו.
      if (input.to === 'SIGNED' && !form.signedByEmployerAt) {
        issues.push({ code: 'F161_MISSING_EMPLOYER_SIG', message: 'נדרשת חתימת מעסיק לפני SIGNED' });
      }
      if (issues.length > 0) throw new Form161TransitionError(issues, form.validationStatus, input.to);
    }

    if (input.to === 'REJECTED' && !input.reason) {
      throw new Form161TransitionError(
        [{ code: 'F161_NO_ALLOCATION', message: 'נדרשת סיבת דחייה' }],
        form.validationStatus,
        input.to,
      );
    }

    return {
      ...form,
      validationStatus: input.to,
      rejectedReason: input.to === 'REJECTED' ? input.reason : form.rejectedReason,
    };
  }
}
