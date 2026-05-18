import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as s3vectors from 'aws-cdk-lib/aws-s3vectors';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

const EMBEDDING_MODEL_ID = 'amazon.titan-embed-text-v2:0';
const VECTOR_DIMENSION = 1024;

export class KnowledgeBaseStack extends cdk.Stack {
  public readonly knowledgeBaseId: string;
  public readonly knowledgeBaseArn: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vectorBucketName = `rag-gw-vectors-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`;

    // S3 Vector Bucket & Index (L1)
    const vectorBucket = new s3vectors.CfnVectorBucket(this, 'VectorBucket', {
      vectorBucketName,
    });

    const vectorIndex = new s3vectors.CfnIndex(this, 'VectorIndex', {
      vectorBucketName,
      indexName: 'rag-gateway-index',
      dimension: VECTOR_DIMENSION,
      distanceMetric: 'cosine',
      dataType: 'float32',
    });
    vectorIndex.addDependency(vectorBucket);

    // Data Source Bucket (L2)
    const dataSourceBucket = new s3.Bucket(this, 'DataSourceBucket', {
      bucketName: `rag-gw-datasource-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    new s3deploy.BucketDeployment(this, 'DeploySampleData', {
      sources: [s3deploy.Source.asset('./sample-data')],
      destinationBucket: dataSourceBucket,
    });

    // KB IAM Role
    const kbRole = new iam.Role(this, 'KnowledgeBaseRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      inlinePolicies: {
        KBPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                's3vectors:CreateIndex',
                's3vectors:DeleteIndex',
                's3vectors:GetIndex',
                's3vectors:ListIndexes',
                's3vectors:PutVectors',
                's3vectors:GetVectors',
                's3vectors:DeleteVectors',
                's3vectors:QueryVectors',
                's3vectors:ListVectors',
              ],
              resources: [
                `arn:aws:s3vectors:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:bucket/${vectorBucketName}`,
                `arn:aws:s3vectors:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:bucket/${vectorBucketName}/index/*`,
              ],
            }),
            new iam.PolicyStatement({
              actions: ['s3:GetObject', 's3:ListBucket'],
              resources: [
                dataSourceBucket.bucketArn,
                `${dataSourceBucket.bucketArn}/*`,
              ],
            }),
            new iam.PolicyStatement({
              actions: ['bedrock:InvokeModel'],
              resources: [
                `arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/${EMBEDDING_MODEL_ID}`,
              ],
            }),
          ],
        }),
      },
    });

    // Knowledge Base (L1)
    const knowledgeBase = new bedrock.CfnKnowledgeBase(this, 'KnowledgeBase', {
      name: 'RagGatewayKnowledgeBase',
      description: 'Knowledge Base for RAG Gateway Kit',
      roleArn: kbRole.roleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: `arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/${EMBEDDING_MODEL_ID}`,
        },
      },
      storageConfiguration: {
        type: 'S3_VECTORS',
        s3VectorsConfiguration: {
          vectorBucketArn: vectorBucket.attrVectorBucketArn,
          indexName: vectorIndex.indexName!,
        },
      },
    });
    knowledgeBase.node.addDependency(vectorIndex);

    const dataSource = new bedrock.CfnDataSource(this, 'DataSource', {
      name: 'S3DocumentSource',
      knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
      dataSourceConfiguration: {
        type: 'S3',
        s3Configuration: {
          bucketArn: dataSourceBucket.bucketArn,
        },
      },
      dataDeletionPolicy: 'RETAIN',
    });

    this.knowledgeBaseId = knowledgeBase.attrKnowledgeBaseId;
    this.knowledgeBaseArn = knowledgeBase.attrKnowledgeBaseArn;

    new cdk.CfnOutput(this, 'KnowledgeBaseIdOutput', {
      value: this.knowledgeBaseId,
      exportName: 'RagGatewayKnowledgeBaseId',
    });

    new cdk.CfnOutput(this, 'DataSourceBucketOutput', {
      value: dataSourceBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'DataSourceIdOutput', {
      value: dataSource.attrDataSourceId,
    });
  }
}
