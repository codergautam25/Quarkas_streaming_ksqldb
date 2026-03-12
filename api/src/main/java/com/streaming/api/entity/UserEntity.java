package com.streaming.api.entity;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import io.quarkus.hibernate.orm.panache.PanacheEntityBase;

@Entity
@Table(name = "users")
public class UserEntity extends PanacheEntityBase {

    @Id
    public String userId;
    
    public String name;
    public String email;
    public String country;
    public String departmentId;
    public double salary;
    public String status;
    public long createdTimestamp;

    // Defaults and empty constructor required by Hibernate
    public UserEntity() {}
}
