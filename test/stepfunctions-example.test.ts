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

  test('creates an EXPRESS state machine with tracing and logging enabled', () => {
    template.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
    template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
      StateMachineType: 'EXPRESS',
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
    // DefinitionString は Fn::Join になっているので、トークン部分をプレースホルダに置き換えてからパースする
    const definitionString = stateMachine.Properties.DefinitionString;
    const raw =
      typeof definitionString === 'string'
        ? definitionString
        : (definitionString['Fn::Join'][1] as unknown[]).map((p) => (typeof p === 'string' ? p : 'TOKEN')).join('');
    const definition = JSON.parse(raw);
    expect(definition).toMatchObject({
      StartAt: 'ValidateInput',
      TimeoutSeconds: 300,
      States: {
        ValidateInput: { Type: 'Choice', Default: 'InvalidInputLog' },
        InvalidInputLog: { Type: 'Task', Next: 'InvalidInput' },
        InvalidInput: { Type: 'Fail', Error: 'ValidationError' },
        Init: { Type: 'Pass', Next: 'StartQuery' },
        StartQuery: { Type: 'Task', Next: 'WaitForQuery' },
        WaitForQuery: { Type: 'Wait', Seconds: 1, Next: 'GetQueryStatus' },
        GetQueryStatus: { Type: 'Task', Next: 'IsDone' },
        IsDone: { Type: 'Choice', Default: 'WaitForQuery' },
        GetResults: { Type: 'Task', End: true },
        QueryFailed: { Type: 'Fail', Error: 'QueryFailed' },
        tooManyRetries: { Type: 'Fail', Error: 'MaxRetryExceeded' },
      },
    });
  });

  test('log group has a retention period', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 3 });
  });

  test('log retention can be overridden', () => {
    const custom = createTemplate({ logRetention: 7 });
    custom.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 7 });
  });

  test('exports the state machine ARN', () => {
    template.hasOutput('StateMachineArn', {});
  });
});
