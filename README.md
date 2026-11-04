# stepfunctions-example

AWS CDK (TypeScript) で AWS Step Functions のステートマシンを定義するサンプルプロジェクトです。

## 構成

| パス                                 | 内容                                                           |
| ------------------------------------ | -------------------------------------------------------------- |
| `bin/stepfunctions-example.ts`       | CDK アプリのエントリポイント。cdk-nag (AwsSolutions) を適用    |
| `lib/stepfunctions-example-stack.ts` | スタック定義 (ステートマシン + CloudWatch Logs)                |
| `test/stepfunctions-example.test.ts` | スナップショットテスト・アサーションテスト                     |
| `test/cdk-nag.test.ts`               | cdk-nag の違反がないことを確認するテスト                       |
| `.github/workflows/`                 | GitHub Actions (CI / prod デプロイ / prod 向け PR の cdk diff) |

## 開発コマンド

| コマンド                          | 内容                                            |
| --------------------------------- | ----------------------------------------------- |
| `npm run lint`                    | Biome による lint・フォーマットチェック         |
| `npm run lint:fix`                | lint・フォーマットの自動修正                    |
| `npm run build`                   | 型チェック (`tsc`)                              |
| `npm test`                        | テスト実行                                      |
| `npm run test:update`             | スナップショットの更新 (意図した変更のときのみ) |
| `npm run test:coverage`           | カバレッジ付きテスト                            |
| `npm run synth`                   | `cdk synth` (cdk-nag の検査もここで実行される)  |
| `npm run check`                   | lint → build → test → synth を一括実行          |
| `npx cdk diff` / `npx cdk deploy` | 差分確認 / デプロイ                             |

## cdk-nag

`bin/stepfunctions-example.ts` で `AwsSolutionsChecks` を `Validations.of(app).addPlugins()` に登録しており、
違反があると `cdk synth` / `cdk deploy` が失敗します。

やむを得ずルールを抑制する場合は、対象のコンストラクトに理由付きで acknowledge してください
(cdk-nag v3 では finding ごとに個別指定が必要です)。

```ts
cdk.Validations.of(construct).acknowledge({
  id: 'AwsSolutions-IAM5[Resource::*]',
  reason: '抑制する理由を具体的に書く',
});
```

## CI/CD

| ワークフロー | トリガー                       | 内容                                                                                          |
| ------------ | ------------------------------ | --------------------------------------------------------------------------------------------- |
| `ci.yml`     | `prod` 以外のブランチへの push | lint / 型チェック / テスト / synth                                                            |
| `deploy.yml` | `prod` ブランチへの push       | `ci.yml` 実行後に OIDC で AWS 認証して `cdk deploy`                                           |
| `diff.yml`   | `prod` ブランチ向けの PR       | OIDC で AWS 認証して `cdk diff` を実行し、結果を PR にコメント (更新時は同じコメントを上書き) |

### 事前準備

1. デプロイ先アカウント/リージョンで `cdk bootstrap` を実行しておく
2. AWS 側で GitHub の OIDC プロバイダ (`token.actions.githubusercontent.com`) と IAM ロールを作成する
3. GitHub リポジトリに以下を設定する

| 種類        | 名前                  | 内容                                                                        |
| ----------- | --------------------- | --------------------------------------------------------------------------- |
| Environment | `prod`                | デプロイジョブが使用。必要に応じて承認者 (Required reviewers) を設定        |
| Variables   | `AWS_DEPLOY_ROLE_ARN` | デプロイ用 IAM ロールの ARN                                                 |
| Variables   | `AWS_REGION`          | デプロイ先リージョン (例: `ap-northeast-1`)                                 |
| Variables   | `AWS_DIFF_ROLE_ARN`   | (任意) diff 用の読み取り専用ロール。未設定時は `AWS_DEPLOY_ROLE_ARN` を使用 |

### IAM ロールの信頼ポリシー

ワークフローごとに OIDC トークンの `sub` が異なります。

- デプロイ (`environment: prod`): `repo:yutaro-sakamoto/stepfunctions-example:environment:prod`
- diff (PR): `repo:yutaro-sakamoto/stepfunctions-example:pull_request`

```json
{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
    "StringLike": {
      "token.actions.githubusercontent.com:sub": [
        "repo:yutaro-sakamoto/stepfunctions-example:environment:prod",
        "repo:yutaro-sakamoto/stepfunctions-example:pull_request"
      ]
    }
  }
}
```

ロールの権限ポリシーは、CDK bootstrap で作成されるロールを引き受けられれば十分です。
diff 用ロールは `lookup-role` / `deploy-role` (テンプレート取得用) を、デプロイ用ロールは
`deploy-role` / `file-publishing-role` / `image-publishing-role` / `lookup-role` を引き受けられるようにしてください。

```json
{
  "Effect": "Allow",
  "Action": "sts:AssumeRole",
  "Resource": "arn:aws:iam::<ACCOUNT_ID>:role/cdk-hnb659fds-*"
}
```
