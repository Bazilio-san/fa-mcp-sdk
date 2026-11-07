import type { IUsedHttpHeader, TesterHeaderRequirement } from '../core/index.js';

const arbitraryHeader: IUsedHttpHeader = {
  name: 'x-project-private-value',
  description: 'Project-defined value',
  isOptional: true,
  isSecret: true,
};

const testerHeader: TesterHeaderRequirement = arbitraryHeader;

export const usedHttpHeaderTypeFixture = { arbitraryHeader, testerHeader };
