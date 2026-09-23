using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TravelDisruptionAgent.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddWebRtcCalls : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "answered_at",
                table: "calls",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ended_reason",
                table: "calls",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "receiver_user_id",
                table: "calls",
                type: "uuid",
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE calls AS call
                SET receiver_user_id = booking.guest_user_id
                FROM cases AS case_item
                INNER JOIN bookings AS booking ON booking.id = case_item.booking_id
                WHERE call.case_id = case_item.id;
                """);

            migrationBuilder.AlterColumn<Guid>(
                name: "receiver_user_id",
                table: "calls",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_calls_receiver_user_id",
                table: "calls",
                column: "receiver_user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_calls_receiver_user_id",
                table: "calls");

            migrationBuilder.DropColumn(
                name: "answered_at",
                table: "calls");

            migrationBuilder.DropColumn(
                name: "ended_reason",
                table: "calls");

            migrationBuilder.DropColumn(
                name: "receiver_user_id",
                table: "calls");
        }
    }
}
