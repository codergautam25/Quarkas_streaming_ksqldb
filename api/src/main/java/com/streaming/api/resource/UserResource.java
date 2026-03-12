package com.streaming.api.resource;

import com.streaming.api.entity.UserEntity;
import com.streaming.avro.User;
import com.streaming.avro.LoginEvent;
import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.reactive.messaging.Channel;
import org.eclipse.microprofile.reactive.messaging.Emitter;
import io.smallrye.reactive.messaging.kafka.Record;
import org.apache.kafka.streams.KafkaStreams;
import org.apache.kafka.streams.StoreQueryParameters;
import org.apache.kafka.streams.state.QueryableStoreTypes;
import org.apache.kafka.streams.state.ReadOnlyWindowStore;
import org.apache.kafka.streams.kstream.Windowed;
import org.apache.kafka.streams.KeyValue;
import org.apache.kafka.streams.state.KeyValueIterator;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

@Path("/users")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class UserResource {

    @Inject
    @Channel("user-events")
    Emitter<User> userEmitter;

    @Inject
    @Channel("login-events")
    Emitter<Record<String, LoginEvent>> loginEmitter;

    @Inject
    KafkaStreams kafkaStreams;

    @GET
    @Path("/{id}")
    public Response getUser(@PathParam("id") String id) {
        UserEntity entity = UserEntity.findById(id);
        if (entity != null) {
            return Response.ok(entity).build();
        }
        return Response.status(Response.Status.NOT_FOUND).build();
    }

    @POST
    @Transactional
    public Response createUser(UserEntity user) {
        if (user.userId == null) {
            user.userId = UUID.randomUUID().toString();
        }
        user.createdTimestamp = Instant.now().toEpochMilli();
        user.persist();

        User avroUser = User.newBuilder()
                .setUserId(user.userId)
                .setName(user.name)
                .setEmail(user.email)
                .setCountry(user.country)
                .setDepartmentId(user.departmentId)
                .setSalary(user.salary)
                .setStatus(user.status)
                .setCreatedTimestamp(user.createdTimestamp)
                .build();
        
        userEmitter.send(avroUser);
        return Response.ok(user).status(201).build();
    }

    @PUT
    @Path("/{id}")
    @Transactional
    public Response updateUser(@PathParam("id") String id, UserEntity update) {
        UserEntity user = UserEntity.findById(id);
        if (user == null) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        user.name = update.name != null ? update.name : user.name;
        user.salary = update.salary > 0 ? update.salary : user.salary;
        user.persist();

        User avroUser = User.newBuilder()
                .setUserId(user.userId)
                .setName(user.name)
                .setEmail(user.email)
                .setCountry(user.country)
                .setDepartmentId(user.departmentId)
                .setSalary(user.salary)
                .setStatus(user.status)
                .setCreatedTimestamp(user.createdTimestamp)
                .build();
        userEmitter.send(avroUser);
        return Response.ok(user).build();
    }

    @DELETE
    @Path("/{id}")
    @Transactional
    public Response deleteUser(@PathParam("id") String id) {
        UserEntity user = UserEntity.findById(id);
        if (user == null) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        user.delete();
        // Send a tombstone logic could go here or simply a DELETED status event
        User avroUser = User.newBuilder()
                .setUserId(user.userId)
                .setName(user.name)
                .setEmail(user.email)
                .setCountry(user.country)
                .setDepartmentId(user.departmentId)
                .setSalary(user.salary)
                .setStatus("DELETED")
                .setCreatedTimestamp(Instant.now().toEpochMilli())
                .build();
        userEmitter.send(avroUser);
        return Response.noContent().build();
    }

    @GET
    @Path("/{id}/fraud-activity")
    public Response getFraudActivity(@PathParam("id") String id) {
        // Interactive query from Kafka Streams State Store
        try {
            ReadOnlyWindowStore<String, Long> store = kafkaStreams.store(
                    StoreQueryParameters.fromNameAndType("fraud-suspicious-users-store", QueryableStoreTypes.windowStore())
            );

            long count = 0;
            // Fetch all windows for this user and sum
            KeyValueIterator<Windowed<String>, Long> iterator = store.all();
            while(iterator.hasNext()) {
                KeyValue<Windowed<String>, Long> curr = iterator.next();
                if(curr.key.key().equals(id)) {
                    count += curr.value;
                }
            }
            return Response.ok("{\"userId\": \"" + id + "\", \"totalCurrentFailedLogins\": " + count + "}").build();
        } catch (Exception e) {
             return Response.status(503).entity("State store not ready").build();
        }
    }

    @POST
    @Path("/{id}/simulate-fraud")
    public Response simulateFraud(@PathParam("id") String id) {
        for (int i = 0; i < 6; i++) {
            LoginEvent event = new LoginEvent(
                UUID.randomUUID().toString(), id, "FAILED", "UNKNOWN_IPA", "10.0.0.99", Instant.now().toEpochMilli()
            );
            loginEmitter.send(Record.of(id, event));
        }
        return Response.ok("{\"userId\": \"" + id + "\", \"status\": \"Fraud cluster events synthesized\"}").build();
    }
}
