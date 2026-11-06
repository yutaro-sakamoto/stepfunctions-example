import * as logs from 'aws-cdk-lib/aws-logs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as cdk from 'aws-cdk-lib/core';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { Validations } from 'aws-cdk-lib';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as athena from 'aws-cdk-lib/aws-athena';

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
      retention: props.logRetention ?? logs.RetentionDays.THREE_DAYS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const bucket = new s3.Bucket(this, 'MyBucket', {
      versioned: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const glueDatabase = new glue.CfnDatabase(this, 'GlueDatabase', {
      catalogId: this.account,
      databaseInput: { name: 'shop' },
    });

    const glueTable = new glue.CfnTable(this, 'Orders', {
      catalogId: this.account,
      databaseName: 'shop',
      tableInput: {
        name: 'orders',
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          classification: 'csv',
          'skip.header.line.count': '1',
        },
        storageDescriptor: {
          location: `s3://${bucket.bucketName}/orders/2026/`,
          columns: [
            { name: 'order_id', type: 'string'},
            { name: 'customer', type: 'string'},
            { name: 'payment', type: 'decimal(12, 2)' },
          ],
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.ioHiveIgnoreKeyTextOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe',
            parameters: { 'field.delim': ',' },
          },
        },
      },
    });

    glueTable.addResourceDependency(glueDatabase);

    const getS3ObjectPrefix = sfn.Pass.jsonata(this, 'Init', {
      outputs: {
        date: `{% (
          $date := $exists($states.input.date) ? $states.input.date : "2026-01-01";
          "s3://${bucket.bucketName}/date=" & $date & "/"
        ) %}`,
      }
    }).next(new sfn.Succeed(this, 'Done'));

    const machineDefinition = getS3ObjectPrefix;

    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(machineDefinition),
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
    Validations.of(bucket).acknowledge({
      id: 'AwsSolutions-S1',
      reason: 'Server access logs are not needed because this is an example application.',
    });
  }
}
