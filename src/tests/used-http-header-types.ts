import type { IUsedHttpHeader } from '../core/index.js';
import type { TesterHeaderRequirement } from '../core/agent-tester/types.js';

const arbitraryHeader: IUsedHttpHeader = {
  name: 'x-project-private-value',
  description: 'Project-defined value',
  isOptional: true,
  isSecret: true,
};

const testerHeader: TesterHeaderRequirement = arbitraryHeader;

export const usedHttpHeaderTypeFixture = { arbitraryHeader, testerHeader };
