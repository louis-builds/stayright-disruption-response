using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TravelDisruptionAgent.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddDisruptionOps : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "assignee_coordinator_id",
                table: "disruptions",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "disruption_exclusions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    disruption_id = table.Column<Guid>(type: "uuid", nullable: false),
                    booking_id = table.Column<Guid>(type: "uuid", nullable: false),
                    reason = table.Column<string>(type: "text", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_disruption_exclusions", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "disruption_window_audits",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    disruption_id = table.Column<Guid>(type: "uuid", nullable: false),
                    actor_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    old_start_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    old_end_at_or_window = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    new_start_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    new_end_at_or_window = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_disruption_window_audits", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_disruption_exclusions_disruption_id_booking_id",
                table: "disruption_exclusions",
                columns: new[] { "disruption_id", "booking_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_disruption_window_audits_disruption_id",
                table: "disruption_window_audits",
                column: "disruption_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "disruption_exclusions");

            migrationBuilder.DropTable(
                name: "disruption_window_audits");

            migrationBuilder.DropColumn(
                name: "assignee_coordinator_id",
                table: "disruptions");
        }
    }
}
