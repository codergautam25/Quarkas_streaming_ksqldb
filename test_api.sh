#!/bin/bash
echo "=== 1. Create User ==="
USER_RES=$(curl -s -X POST http://localhost:8080/users -H "Content-Type: application/json" -d '{"name":"Alice Tester", "email":"alice@test.com", "country":"UK", "departmentId":"SALES", "salary": 85000, "status": "ACTIVE"}')
echo "$USER_RES"
USER_ID=$(echo $USER_RES | grep -o '"userId":"[^"]*' | grep -o '[^"]*$')
echo "Extracted ID: $USER_ID"

if [ -n "$USER_ID" ]; then
    echo -e "\n=== 2. Get User ==="
    curl -s -X GET http://localhost:8080/users/$USER_ID
    
    echo -e "\n\n=== 3. Update User ==="
    curl -s -X PUT http://localhost:8080/users/$USER_ID -H "Content-Type: application/json" -d '{"name":"Alice Updated", "salary": 90000}'
    
    echo -e "\n\n=== 4. Check Fraud Activity (Kafka Streams) ==="
    curl -s -X GET http://localhost:8080/users/$USER_ID/fraud-activity
    
    echo -e "\n\n=== 5. Verify in PostgreSQL ==="
    docker exec postgres psql -U user -d streamingdb -c "SELECT user_id, name, salary FROM users WHERE user_id = '$USER_ID';"
    
    echo -e "\n=== 6. Delete User ==="
    DEL_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE http://localhost:8080/users/$USER_ID)
    echo "Delete Response Code: $DEL_STATUS"
    
    echo -e "\n=== 7. Verify Deletion ==="
    curl -w "\nStatus Code: %{http_code}\n" -s -X GET http://localhost:8080/users/$USER_ID
else
    echo "Failed to create user."
fi
