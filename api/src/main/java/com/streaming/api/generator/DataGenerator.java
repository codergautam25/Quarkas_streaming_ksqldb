package com.streaming.api.generator;

import com.streaming.avro.CountryRisk;
import com.streaming.avro.Department;
import com.streaming.avro.LoginEvent;
import com.streaming.avro.User;
import io.smallrye.reactive.messaging.kafka.Record;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.reactive.messaging.Channel;
import org.eclipse.microprofile.reactive.messaging.Emitter;

import java.time.Instant;
import java.util.Random;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

@ApplicationScoped
@Path("/api/generate")
public class DataGenerator {

    @Inject
    @Channel("user-events")
    Emitter<Record<String, User>> userEmitter;

    @Inject
    @Channel("login-events")
    Emitter<Record<String, LoginEvent>> loginEmitter;

    @Inject
    @Channel("department-events")
    Emitter<Record<String, Department>> deptEmitter;

    @Inject
    @Channel("country-risk-events")
    Emitter<Record<String, CountryRisk>> riskEmitter;

    private static final int TOTAL_RECORDS = 5_000_000;
    private static final String[] COUNTRIES = {"USA", "IN", "UK", "BR", "CA", "FR", "DE", "CN", "RU", "NG"};
    private static final String[] DEPTS = {"HR", "ENG", "SALES", "MARKETING", "FINANCE"};
    private static final String[] DEVICES = {"CORPORATE_DEVICE", "PERSONAL_MOBILE", "UNKNOWN_IPA", "TABLET"};
    private static final String[] LOGIN_STATUS = {"SUCCESS", "FAILED"};

    private final ExecutorService executor = Executors.newFixedThreadPool(Runtime.getRuntime().availableProcessors() * 2);
    private final AtomicInteger generatedCount = new AtomicInteger(0);
    private boolean isGenerating = false;

    @POST
    public Response startGenerating() {
        if (isGenerating) {
            return Response.status(Response.Status.CONFLICT).entity("Generation already in progress").build();
        }
        isGenerating = true;
        generatedCount.set(0);

        // Pre-seed some Reference data
        for (String c : COUNTRIES) {
            String risk = (c.equals("RU") || c.equals("CN") || c.equals("NG")) ? "HIGH" : "LOW";
            CountryRisk cr = new CountryRisk(c, risk);
            riskEmitter.send(Record.of(c, cr));
        }

        for (String d : DEPTS) {
            Department dept = new Department(d, d + " Department", 1000000.0);
            deptEmitter.send(Record.of(d, dept));
        }

        // Fire off data generation
        executor.submit(() -> {
            Random rand = new Random();
            long startTime = System.currentTimeMillis();
            
            for (int i = 0; i < TOTAL_RECORDS; i++) {
                String userId = UUID.randomUUID().toString();
                String country = COUNTRIES[rand.nextInt(COUNTRIES.length)];
                String dept = DEPTS[rand.nextInt(DEPTS.length)];
                double salary = 40000 + (rand.nextDouble() * 100000);

                User user = User.newBuilder()
                        .setUserId(userId)
                        .setName("User_" + i)
                        .setEmail("user" + i + "@example.com")
                        .setCountry(country)
                        .setDepartmentId(dept)
                        .setSalary(salary)
                        .setStatus("ACTIVE")
                        .setCreatedTimestamp(Instant.now().toEpochMilli())
                        .build();

                userEmitter.send(Record.of(userId, user));

                // Generate 1-3 login events for this user
                int loginCount = 1 + rand.nextInt(3);
                for(int j = 0; j < loginCount; j++) {
                    String loginId = UUID.randomUUID().toString();
                    String status = LOGIN_STATUS[rand.nextInt(LOGIN_STATUS.length)];
                    
                    // Force a burst of FAILED logins sometimes to trigger fraud topology
                    if (rand.nextDouble() > 0.99) {
                        for (int k = 0; k < 6; k++) {
                            LoginEvent fraudEvent = new LoginEvent(
                                UUID.randomUUID().toString(), userId, "FAILED", "UNKNOWN_IPA", "192.168.1." + rand.nextInt(255), Instant.now().toEpochMilli()
                            );
                            loginEmitter.send(Record.of(userId, fraudEvent));
                        }
                    } else {
                        LoginEvent event = new LoginEvent(
                            loginId, userId, status, DEVICES[rand.nextInt(DEVICES.length)], "10.0.0." + rand.nextInt(255), Instant.now().toEpochMilli()
                        );
                        loginEmitter.send(Record.of(userId, event));
                    }
                }
                
                int count = generatedCount.incrementAndGet();
                if (count % 100000 == 0) {
                    System.out.println("Generated " + count + " records so far...");
                }
            }
            
            long endTime = System.currentTimeMillis();
            System.out.println("Finished generating " + TOTAL_RECORDS + " records in " + (endTime - startTime) + " ms");
            isGenerating = false;
        });

        return Response.accepted("Data generation started for " + TOTAL_RECORDS + " records. Target ~20k/sec.").build();
    }
}
