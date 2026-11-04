import * as cdk from 'aws-cdk-lib/core';
import { AwsSolutionsChecks } from 'cdk-nag';
import { StepfunctionsExampleStack } from '../lib/stepfunctions-example-stack';

describe('cdk-nag AwsSolutions checks', () => {
  test('has no unacknowledged violations', () => {
    const app = new cdk.App();
    const stack = new StepfunctionsExampleStack(app, 'TestStack', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
    });

    const report = new AwsSolutionsChecks().validateScope(stack);

    // 失敗時に違反ルールと対象リソースが分かるよう、配列で比較する
    expect(
      report.violations.map((v) => `${v.ruleName}: ${v.violatingResources.map((r) => r.constructPath).join(', ')}`),
    ).toEqual([]);
    expect(report.success).toBe(true);
  });
});
