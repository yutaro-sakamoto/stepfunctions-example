import * as logs from 'aws-cdk-lib/aws-logs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as cdk from 'aws-cdk-lib/core';
import type { Construct } from 'constructs';

export interface StepfunctionsExampleStackProps extends cdk.StackProps {
  /**
   * ステートマシンの実行ログの保持期間
   * @default logs.RetentionDays.ONE_MONTH
   */
  readonly logRetention?: logs.RetentionDays;
}

export class StepfunctionsExampleStack extends cdk.Stack {
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: StepfunctionsExampleStackProps = {}) {
    super(scope, id, props);

    const logGroup = new logs.LogGroup(this, 'StateMachineLogGroup', {
      retention: props.logRetention ?? logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const definition = new sfn.Pass(this, 'Hello', {
      result: sfn.Result.fromObject({ message: 'Hello, Step Functions!' }),
    }).next(new sfn.Succeed(this, 'Done'));

    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      stateMachineType: sfn.StateMachineType.STANDARD,
      timeout: cdk.Duration.minutes(5),
      tracingEnabled: true,
      logs: {
        destination: logGroup,
        level: sfn.LogLevel.ALL,
        includeExecutionData: true,
      },
    });

    // ログ配信 (CloudWatch Logs vended logs) と X-Ray の API はリソースレベルの制限ができないため
    // CDK が生成するポリシーには Resource: '*' が含まれる
    cdk.Validations.of(this.stateMachine).acknowledge({
      id: 'AwsSolutions-IAM5[Resource::*]',
      reason:
        'CloudWatch Logs delivery and X-Ray APIs used by Step Functions do not support resource-level permissions.',
    });

    new cdk.CfnOutput(this, 'StateMachineArn', { value: this.stateMachine.stateMachineArn });
  }
}
