import * as logs from 'aws-cdk-lib/aws-logs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as cdk from 'aws-cdk-lib/core';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as path from 'node:path';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';
import { Validations } from 'aws-cdk-lib';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as athena from 'aws-cdk-lib/aws-athena';
import { RegionInfo } from 'aws-cdk-lib/region-info';
import { ApplicationTargetGroup } from 'aws-cdk-lib/aws-elasticloadbalancingv2';

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

    // cdk-nag の finding ID に入る ARN は実行経路で表記が変わる (partition が `aws` か `<AWS::Partition>`、
    // account が実 ID か `<AWS::AccountId>`) ため、スタックの値から組み立てて両方の partition 表記を acknowledge する
    const render = (value: string, pseudo: string) => (cdk.Token.isUnresolved(value) ? `<${pseudo}>` : value);
    const region = render(this.region, 'AWS::Region');
    const account = render(this.account, 'AWS::AccountId');
    const partitions = new Set(['<AWS::Partition>']);
    if (!cdk.Token.isUnresolved(this.region)) {
      const partition = RegionInfo.get(this.region).partition;
      if (partition) partitions.add(partition);
    }

    const logGroup = new logs.LogGroup(this, 'StateMachineLogGroup', {
      retention: props.logRetention ?? logs.RetentionDays.THREE_DAYS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const appLogGroup = new logs.LogGroup(this, 'StateMachineAppLogGroup', {
      retention: props.logRetention ?? logs.RetentionDays.THREE_DAYS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const logStream = new logs.LogStream(this, 'AppLogStream', {
      logGroup: appLogGroup,
      logStreamName: 'step-functions',
    });

    const logStreamArn = cdk.Stack.of(this).formatArn({
      service: 'logs',
      resource: 'log-group',
      resourceName: `${appLogGroup.logGroupName}:log-stream:${logStream.logStreamName}`,
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    });

    const bucket = new s3.Bucket(this, 'MyBucket', {
      versioned: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // テスト用 CSV (test-data/orders/date=YYYY-MM-DD/*.csv) をデプロイ時にバケットへ投入する
    // prune: false で、手動で追加したオブジェクトがデプロイのたびに消されないようにする
    new s3deploy.BucketDeployment(this, 'TestData', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '..', 'test-data', 'orders'))],
      destinationBucket: bucket,
      prune: false,
    });

    // BucketDeployment はスタック直下にシングルトンの Lambda (Custom::CDKBucketDeployment...) を作る。
    // ロール・ポリシー・ランタイムは CDK 側で決まっていて変更できないため、この Lambda 配下に限って acknowledge する
    const deploymentHandlers = this.node.children.filter((c) => c.node.id.startsWith('Custom::CDKBucketDeployment'));
    for (const handler of deploymentHandlers) {
      const validations = cdk.Validations.of(handler);
      validations.acknowledge({
        id: 'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]',
        reason: 'The CDK-managed BucketDeployment handler uses the AWS managed basic execution role for CloudWatch Logs.',
      });
      for (const action of ['s3:GetBucket*', 's3:GetObject*', 's3:List*', 's3:Abort*', 's3:DeleteObject*']) {
        validations.acknowledge({
          id: `AwsSolutions-IAM5[Action::${action}]`,
          reason: `The CDK-managed BucketDeployment handler is granted ${action} to copy assets into the destination bucket.`,
        });
      }
      // CDK のアセットバケット (cdk bootstrap で作られる) から zip を読むための権限
      const qualifier = this.node.tryGetContext('@aws-cdk/core:bootstrapQualifier') ?? 'hnb659fds';
      for (const partition of partitions) {
        validations.acknowledge({
          id: `AwsSolutions-IAM5[Resource::arn:${partition}:s3:::cdk-${qualifier}-assets-${account}-${region}/*]`,
          reason: 'The BucketDeployment handler reads deployment assets from any object in the CDK bootstrap asset bucket.',
        });
      }
      // 投入先バケット内の全オブジェクトへの書き込み権限
      validations.acknowledge({
        id: `AwsSolutions-IAM5[Resource::<${this.getLogicalId(bucket.node.defaultChild as s3.CfnBucket)}.Arn>/*]`,
        reason: 'The BucketDeployment handler writes test data to arbitrary keys in the destination bucket.',
      });
      validations.acknowledge({
        id: 'AwsSolutions-L1',
        reason: 'The BucketDeployment handler runtime is managed by aws-cdk-lib and cannot be configured.',
      });
    }

    const athenaResultBucket = new s3.Bucket(this, 'AhtenaResultBucket', {
      versioned: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })

    const glueDatabase = new glue.CfnDatabase(this, 'GlueDatabase', {
      catalogId: this.account,
      databaseInput: { name: 'shop' },
    });

    const databaseName = 'shop';

    const glueTable = new glue.CfnTable(this, 'Orders', {
      catalogId: this.account,
      databaseName: databaseName,
      tableInput: {
        name: 'orders',
        tableType: 'EXTERNAL_TABLE',
        partitionKeys: [
          { name: 'dt', type: 'string'}
        ],
        parameters: {
          classification: 'csv',
          'skip.header.line.count': '1',
          'projection.enabled': 'true',
          'projection.dt.type': 'date',
          'projection.dt.format': 'yyyy-MM-dd',
          'projection.dt.interval': '1',
          'projection.dt.interval.unit': 'DAYS',
          'projection.dt.range': '2026-01-01,NOW',
          'storage.location.template': `s3://${bucket.bucketName}/date=\${dt}/`,
        },
        storageDescriptor: {
          location: `s3://${bucket.bucketName}/`,
          columns: [
            { name: 'order_id', type: 'string'},
            { name: 'customer', type: 'string'},
            { name: 'payment', type: 'decimal(12,2)' },
          ],
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe',
            parameters: { 'field.delim': ',' },
          },
        },
      },
    });

    glueTable.addResourceDependency(glueDatabase);

    const workGroup = new athena.CfnWorkGroup(this, 'WorkGroup', {
      name: 'stepfunctions-example',
      recursiveDeleteOption: true,
      workGroupConfiguration: {
        enforceWorkGroupConfiguration: true,
        resultConfiguration: {
          outputLocation: `s3://${athenaResultBucket.bucketName}/athena-results/`,
        },
      },
    });

    const invalidInput = tasks.CallAwsService.jsonata(this, 'WriteLog', {
      service: 'cloudwatchlogs',
      action: 'putLogEvents',
      parameters: {
        LogGroupName: appLogGroup.logGroupName,
        LogStreamName: logStream.logStreamName,
        LogEvents: [
          {
            Timestamp: '{% $millis() %}',
            Message: 'Error input',
          },
        ],
      },
      iamResources: [logStreamArn],
      iamAction: 'logs:PutLogEvents',
      outputs: '{% $states.input %}'
    }).next(
    sfn.Fail.jsonata(this, 'InvalidInput', {
      error: 'ValidationError',
      cause: '{% "Invalid input: " & $string($states.input) %}',
    }));

    const processInput = sfn.Pass.jsonata(this, 'Init', {
      outputs: {
        date: `{%
          $states.input.date < "2026-01-01" ? "2026-01-01" : $states.input.date
        %}`,
      }
    }).next(tasks.AthenaStartQueryExecution.jsonata(this, 'Query', {
      queryString: 'SELECT SUM(payment) AS total FROM orders WHERE dt = ?',
      executionParameters: [
        `{% "'" & $states.input.date & "'" %}`
      ],
      queryExecutionContext: { databaseName },
      workGroup: workGroup.ref,
      integrationPattern: sfn.IntegrationPattern.RUN_JOB,
    })).next(tasks.AthenaGetQueryResults.jsonata(this, 'GetResults', {
      queryExecutionId: '{% $states.input.QueryExecution.QueryExecutionId %}',
      outputs: {
        total: '{% $states.result.ResultSet.Rows[1].Data[0].VarCharValue %}'
      },
    }));

    const machineDefinition = sfn.Choice.jsonata(this, 'ValidateInput')
      .when(
        sfn.Condition.jsonata(
          '{% $type($states.input.date) = "string" and $contains($states.input.date, /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) %}'
        ),
        processInput
      ).otherwise(invalidInput);

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

    // AthenaStartQueryExecution が付与する Glue 権限は、データベース配下の全テーブル/関数を対象にする
    for (const partition of partitions) {
      for (const resource of ['table', 'userDefinedFunction']) {
        cdk.Validations.of(this.stateMachine).acknowledge({
          id: `AwsSolutions-IAM5[Resource::arn:${partition}:glue:${region}:${account}:${resource}/${databaseName}/*]`,
          reason: `Athena queries need Glue catalog access to every ${resource} in the ${databaseName} database.`,
        });
      }
    }

    Validations.of(athenaResultBucket).acknowledge({
      id: 'AwsSolutions-S1',
      reason: 'Server access logs are not needed for the Athena query result bucket in this example application.',
    });

    new cdk.CfnOutput(this, 'StateMachineArn', { value: this.stateMachine.stateMachineArn });
    Validations.of(bucket).acknowledge({
      id: 'AwsSolutions-S1',
      reason: 'Server access logs are not needed because this is an example application.',
    });
  }
}
