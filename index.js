const AWS = require("aws-sdk");
const Table = require("cli-table3");
const chalk = require("chalk");
const _ = require("lodash/fp");

const docClient = new AWS.DynamoDB.DocumentClient();
const ddb = new AWS.DynamoDB();

const outputs = JSON.parse(process.env.TERRAFORM_OUTPUT);

const USERS_TABLE = outputs["users-table"].value;
const UNIQUES_TABLE = outputs["uniques-table"].value;

const clearDbs = async () => {
	const users = await docClient.scan({TableName: USERS_TABLE}).promise();
	if (users.Items.length > 0) {
		await docClient.batchWrite({
			RequestItems: {
				[USERS_TABLE]: users.Items.map(({ID}) => ({
					DeleteRequest: {
						Key: {ID},
					},
				})),
			}
		}).promise();
	}
	const uniques = await docClient.scan({TableName: UNIQUES_TABLE}).promise();
	if (uniques.Items.length > 0) {
		await docClient.batchWrite({
			RequestItems: {
				[UNIQUES_TABLE]: uniques.Items.map(({value, type}) => ({
					DeleteRequest: {
						Key: {value, type},
					},
				})),
			}
		}).promise();
	}
};

const printDb = async () => {
	const printTable = async (tableName) => {
		const res = await docClient.scan({
			TableName: tableName,
		}).promise();
		const tableInfo = await ddb.describeTable({
			TableName: tableName,
		}).promise();
		const keys = tableInfo.Table.KeySchema;

		const allProperties = _.flow(
			_.map(({AttributeName}) => AttributeName),
			_.concat(
				_.flatMap((o) => Object.keys(o))(res.Items),
			),
			_.uniq,
			_.map((property) => {
				const keySchema = keys.find(({AttributeName}) => AttributeName === property);

				return {
					property: property,
					key: keySchema ? keySchema.KeyType : undefined,
				};
			}),
			_.sortBy(({key}) => {
				return key ?
					key === "HASH" ? 0 : 1
					: 2;
			}),
		)(keys);
		const headerRow = _.flow(
			_.map(({property, key}) => key === "HASH" ? chalk.black.bgGreen(` ${property} `) + " (PK)" : key === "RANGE" ? chalk.black.bgYellow(` ${property} `)+ " (SK)" : chalk.white(property)),
			_.map((v) => ({
				content: v,
				hAlign: "center",
			})),
		)(allProperties);

		const dataRows = _.flow(
			_.map((row) => _.flow(
				_.map(({property, key}) => {
					const value = row[property];
					return key ? chalk.bold(value) : chalk.white(value);
				}),
			)(allProperties)),
		)(res.Items);
		const table = new Table({});
		table.push([{colSpan: headerRow.length, content: tableName, hAlign: "center"}]);
		table.push(headerRow);
		dataRows.forEach((r) => table.push(r));

		console.log(table.toString());
	};

	await printTable(USERS_TABLE);
	await printTable(UNIQUES_TABLE);
};

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

const updateUser = async (id, email, username) => {
	const currentUser = (await docClient.get({
		TableName: USERS_TABLE,
		Key: {ID: id},
	}).promise()).Item;

	if (currentUser.email !== email || currentUser.username !== username) {
		const TransactItems = [
			{
				Update: {
					TableName: USERS_TABLE,
					Key: {ID: id},
					UpdateExpression: "SET " + [...currentUser.email !== email ? ["#email = :email"] : [], ...currentUser.username !== username ? ["#username = :username"] : []].join(", "),
					ExpressionAttributeNames: {...currentUser.email !== email ? {"#email": "email"} : {}, ...currentUser.username !== username ? {"#username": "username"} : {}},
					ExpressionAttributeValues: {...currentUser.email !== email ? {":email": email, ":currentemail": currentUser.email} : {}, ...currentUser.username !== username ? {":username": username, ":currentusername": currentUser.username} : {}},
					ConditionExpression: [...currentUser.email !== email ? ["#email = :currentemail"]: [], ...currentUser.username !== username ? ["#username = :currentusername"] : []].join(" AND "),
				}
			},
			...currentUser.email !== email ? [
				{
					Delete: {
						TableName: UNIQUES_TABLE,
						Key: {
							value: currentUser.email,
							type: "email",
						},
						ConditionExpression: "attribute_exists(#pk)",
						ExpressionAttributeNames: {
							"#pk": "value",
						},
					}
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
			] : [],
			...currentUser.username !== username ? [
				{
					Delete: {
						TableName: UNIQUES_TABLE,
						Key: {
							value: currentUser.username,
							type: "username",
						},
						ConditionExpression: "attribute_exists(#pk)",
						ExpressionAttributeNames: {
							"#pk": "value",
						},
					}
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
			] : [],
		];

		return docClient.transactWrite({
			TransactItems,
		}).promise();
	}
};

const deleteUser = async (id) => {
	const currentUser = (await docClient.get({
		TableName: USERS_TABLE,
		Key: {ID: id},
	}).promise()).Item;

	const TransactItems = [
		{
			Delete: {
				TableName: USERS_TABLE,
				Key: {ID: id},
				ExpressionAttributeNames: {
					"#email": "email",
					"#username": "username",
				},
				ExpressionAttributeValues: {
					":email": currentUser.email,
					":username": currentUser.username,
				},
				ConditionExpression: "#email = :email AND #username = :username",
			}
		},
		{
			Delete: {
				TableName: UNIQUES_TABLE,
				Key: {
					value: currentUser.email,
					type: "email",
				},
				ConditionExpression: "attribute_exists(#pk)",
				ExpressionAttributeNames: {
					"#pk": "value",
				},
			}
		},
		{
			Delete: {
				TableName: UNIQUES_TABLE,
				Key: {
					value: currentUser.username,
					type: "username",
				},
				ConditionExpression: "attribute_exists(#pk)",
				ExpressionAttributeNames: {
					"#pk": "value",
				},
			}
		},
	];

	return docClient.transactWrite({
		TransactItems,
	}).promise();
};

(async () => {
	await clearDbs();

	console.log("=====Adding user1=====");
	await insertUser("user1", "user1@example.com", "user1");
	await printDb();
	console.log("Adding user2 with the same email");
	try {
		await insertUser("user2", "user1@example.com", "user2");
	}catch(e) {
		console.log("Failed");
	}
	console.log("Adding user2 with the same username");
	try {
		await insertUser("user2", "user2@example.com", "user1");
	}catch(e) {
		console.log("Failed");
	}
	await printDb();
	console.log("=====Adding user2=====");
	await insertUser("user2", "user2@example.com", "user2");

	await printDb();

	console.log("=====Changing email=====");
	await updateUser("user1", "user1-2@example.com", "user1");
	await printDb();
	console.log("=====Changing username=====");
	await updateUser("user1", "user1-2@example.com", "user1-2");
	await printDb();
	console.log("=====Changing both username and email=====");
	await updateUser("user1", "user1-3@example.com", "user1-3");

	await printDb();

	console.log("===== Delete user2 =====");
	await deleteUser("user2");
	await printDb();
})();
