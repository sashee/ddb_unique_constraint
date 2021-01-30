provider "aws" {
}

# DDB

resource "random_id" "id" {
  byte_length = 8
}

resource "aws_dynamodb_table" "users" {
  name         = "ddb_unique_constraint_sample_${random_id.id.hex}_user"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "ID"

  attribute {
    name = "ID"
    type = "S"
  }
}
resource "aws_dynamodb_table" "uniques" {
  name         = "ddb_unique_constraint_sample_${random_id.id.hex}_unique"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "value"
	range_key = "type"

  attribute {
    name = "value"
    type = "S"
  }
  attribute {
    name = "type"
    type = "S"
  }
}

output "users-table" {
	value = aws_dynamodb_table.users.id
}
output "uniques-table" {
	value = aws_dynamodb_table.uniques.id
}
