#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { AwsSolutionsChecks } from 'cdk-nag';
import { StepfunctionsExampleStack } from '../lib/stepfunctions-example-stack';

const app = new cdk.App();

new StepfunctionsExampleStack(app, 'StepfunctionsExampleStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

cdk.Tags.of(app).add('Project', 'stepfunctions-example');

// cdk-nag: AWS Solutions ルールパックで synth 時にセキュリティ/ベストプラクティスを検査する
cdk.Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
