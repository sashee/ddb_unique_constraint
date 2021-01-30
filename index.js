const AWS = require("aws-sdk");
const {nanoid} = require("nanoid");

const docClient = new AWS.DynamoDB.DocumentClient();

const outputs = JSON.parse(process.env.TERRAFORM_OUTPUT)

const USERS_TABLE = outputs["users-table"].value;
const UNIQUES_TABLE = outputs["uniques-table"].value;


(async () => {
	const insertUser = (id, email, username) => {
		return docClient.transactWrite({
			TransactItems: [
				{
					Put: {
						TableName: USERS_TABLE,
						ConditionExpression: "attribute_not_exists(#pk)",
						ExpressionAttributeNames: {
							"#pk": "ID",
						},
						Item: {
							ID: id,
							email,
							username,
						}
					},
				},
				{
					Put: {
						TableName: UNIQUES_TABLE,
						ConditionExpression: "attribute_not_exists(#pk)",
						ExpressionAttributeNames: {
							"#pk": "value",
						},
						Item: {
							value: email,
							type: "email",
						}
					},
				},
				{
					Put: {
						TableName: UNIQUES_TABLE,
						ConditionExpression: "attribute_not_exists(#pk)",
						ExpressionAttributeNames: {
							"#pk": "value",
						},
						Item: {
							value: username,
							type: "username",
						}
					},
				}
			]
		}).promise();
	};

	const id = nanoid(5);

	console.log("Adding user1");
	await insertUser(`user1-${id}`, `user1-${id}@example.com`, `user1-${id}`);
	console.log("Adding user2 with the same email");
	try {
		await insertUser(`user2-${id}`, `user1-${id}@example.com`, `user2-${id}`);
	}catch(e) {
		console.log("Failed");
	}
	console.log("Adding user2 with the same username");
	try {
		await insertUser(`user2-${id}`, `user2-${id}@example.com`, `user1-${id}`);
	}catch(e) {
		console.log("Failed");
	}
	console.log("Adding user2");
	await insertUser(`user2-${id}`, `user2-${id}@example.com`, `user2-${id}`);
})();
