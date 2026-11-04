import { Match, Template } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib/core';
import { StepfunctionsExampleStack } from '../lib/stepfunctions-example-stack';

const createTemplate = (props = {}) => {
  const app = new cdk.App();
  const stack = new StepfunctionsExampleStack(app, 'TestStack', {
    env: { account: '123456789012', region: 'ap-northeast-1' },
    ...props,
  });
  return Template.fromStack(stack);
};

describe('StepfunctionsExampleStack', () => {
  const template = createTemplate();

  test('snapshot', () => {
    // 意図した変更の場合は `npm run test:update` でスナップショットを更新する
    expect(template.toJSON()).toMatchSnapshot();
  });

  test('creates a STANDARD state machine with tracing and logging enabled', () => {
    template.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
    template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
      StateMachineType: 'STANDARD',
      TracingConfiguration: { Enabled: true },
      LoggingConfiguration: {
        Level: 'ALL',
        IncludeExecutionData: true,
        Destinations: [
          {
            CloudWatchLogsLogGroup: {
              LogGroupArn: { 'Fn::GetAtt': [Match.stringLikeRegexp('^StateMachineLogGroup'), 'Arn'] },
            },
          },
        ],
      },
    });
  });

  test('state machine definition is valid ASL', () => {
    const [stateMachine] = Object.values(template.findResources('AWS::StepFunctions::StateMachine'));
    const definition = JSON.parse(stateMachine.Properties.DefinitionString as string);
    expect(definition).toMatchObject({
      StartAt: 'Hello',
      TimeoutSeconds: 300,
      States: {
        Hello: { Type: 'Pass', Next: 'Done' },
        Done: { Type: 'Succeed' },
      },
    });
  });

  test('log group has a retention period', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 30 });
  });

  test('log retention can be overridden', () => {
    const custom = createTemplate({ logRetention: 7 });
    custom.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 7 });
  });

  test('exports the state machine ARN', () => {
    template.hasOutput('StateMachineArn', {});
  });
});
