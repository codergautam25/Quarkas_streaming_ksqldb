# Stage 1: Build the application
FROM maven:3.9.5-eclipse-temurin-17 AS builder
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn package -DskipTests

# Stage 2: Create the runtime image
FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=builder /app/target/quarkus-app/lib/ /app/lib/
COPY --from=builder /app/target/quarkus-app/*.jar /app/
COPY --from=builder /app/target/quarkus-app/app/ /app/app/
COPY --from=builder /app/target/quarkus-app/quarkus/ /app/quarkus/

ENV QUARKUS_PROFILE=docker
EXPOSE 8080

CMD ["java", "-jar", "quarkus-run.jar"]
