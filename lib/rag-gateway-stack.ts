import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as bedrockagentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as path from 'path';
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import { Construct } from 'constructs';

const AWS_KNOWLEDGE_MCP_ENDPOINT = 'https://knowledge-mcp.global.api.aws';

interface RagGatewayStackProps extends cdk.StackProps {
  knowledgeBaseId: string;
  knowledgeBaseArn: string;
}

export class GatewayStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RagGatewayStackProps) {
    super(scope, id, props);

    // --- Lambda: KB Retrieve ---
    const kbRetrieveFn = new lambda.Function(this, 'KBRetrieveFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'kb-retrieve')),
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment: {
        KNOWLEDGE_BASE_ID: props.knowledgeBaseId,
      },
    });

    kbRetrieveFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:Retrieve'],
        resources: [props.knowledgeBaseArn],
      }),
    );

    // --- Runtime: FastMCP Web Tools ---
    const webToolsRuntime = new agentcore.Runtime(this, 'WebToolsRuntime', {
      runtimeName: 'GatewayKitWebTools',
      description: 'MCP Server providing web page fetch tool',
      agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromAsset(
        path.join(__dirname, '..', 'mcp-server'),
      ),
      protocolConfiguration: agentcore.ProtocolType.MCP,
      networkConfiguration: agentcore.RuntimeNetworkConfiguration.usingPublicNetwork(),
    });

    // --- Gateway (IAM auth) ---
    const gateway = new agentcore.Gateway(this, 'RagGateway', {
      gatewayName: 'rag-gateway-kit',
      description: 'RAG Gateway Kit: KB Retrieve + Web Fetch + AWS Knowledge',
      authorizerConfiguration: agentcore.GatewayAuthorizer.usingAwsIam(),
    });

    // Gateway ロールに Runtime invoke 権限を付与
    gateway.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: [
          cdk.Fn.sub('arn:aws:bedrock-agentcore:${AWS::Region}:${AWS::AccountId}:runtime/*'),
        ],
      }),
    );

    // Target 1: Lambda — KB Retrieve (L2)
    gateway.addLambdaTarget('KBRetrieveTarget', {
      gatewayTargetName: 'kb-retrieve',
      lambdaFunction: kbRetrieveFn,
      toolSchema: agentcore.ToolSchema.fromInline([
        {
          name: 'retrieve_documents',
          description:
            'ナレッジベースからドキュメントを検索します。社内ドキュメントや登録済みの情報を自然言語で検索できます。',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {
              query: {
                type: agentcore.SchemaDefinitionType.STRING,
                description: '検索クエリ（自然言語）',
              },
              maxResults: {
                type: agentcore.SchemaDefinitionType.INTEGER,
                description: '最大取得件数（デフォルト: 5）',
              },
            },
            required: ['query'],
          },
        },
      ]),
    });

    // Target 2: MCP Server on Runtime — Web Tools (L1)
    // エンドポイント URL = ARN を URL エンコードして埋め込む
    const runtimeEndpointUrl = cdk.Fn.sub(
      'https://bedrock-agentcore.${AWS::Region}.amazonaws.com/runtimes/arn%3Aaws%3Abedrock-agentcore%3A${AWS::Region}%3A${AWS::AccountId}%3Aruntime%2F${RuntimeId}/invocations',
      { RuntimeId: webToolsRuntime.agentRuntimeId },
    );

    const webToolsTarget = new bedrockagentcore.CfnGatewayTarget(this, 'WebToolsTarget', {
      gatewayIdentifier: gateway.gatewayId,
      name: 'web-tools',
      description: 'Web page fetch tool powered by FastMCP on AgentCore Runtime',
      targetConfiguration: {
        mcp: {
          mcpServer: {
            endpoint: runtimeEndpointUrl,
          },
        },
      },
      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
          credentialProvider: {
            iamCredentialProvider: {
              service: 'bedrock-agentcore',
            },
          },
        },
      ],
    });
    webToolsTarget.addDependency(
      webToolsRuntime.node.defaultChild as cdk.CfnResource,
    );
    const gatewayDefaultPolicy = gateway.role.node.findChild('DefaultPolicy').node.defaultChild as cdk.CfnResource;
    webToolsTarget.addDependency(gatewayDefaultPolicy);

    // Target 3: AWS Knowledge MCP Server (L1)
    new bedrockagentcore.CfnGatewayTarget(this, 'AWSKnowledgeTarget', {
      gatewayIdentifier: gateway.gatewayId,
      name: 'aws-knowledge',
      description: 'AWS official documentation search (hosted MCP server)',
      targetConfiguration: {
        mcp: {
          mcpServer: {
            endpoint: AWS_KNOWLEDGE_MCP_ENDPOINT,
          },
        },
      },
      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
          credentialProvider: {
            iamCredentialProvider: {
              service: 'execute-api',
            },
          },
        },
      ],
    });

    // --- Outputs ---
    new cdk.CfnOutput(this, 'GatewayId', {
      value: gateway.gatewayId,
    });

    new cdk.CfnOutput(this, 'GatewayUrl', {
      value: gateway.gatewayUrl ?? 'pending',
    });


    new cdk.CfnOutput(this, 'RuntimeId', {
      value: webToolsRuntime.agentRuntimeId,
    });
  }
}
