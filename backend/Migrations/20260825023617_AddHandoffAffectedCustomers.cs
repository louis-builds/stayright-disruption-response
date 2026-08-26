using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TravelDisruptionAgent.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddHandoffAffectedCustomers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "handoff_affected_customers",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    disruption_id = table.Column<Guid>(type: "uuid", nullable: false),
                    external_guest_id = table.Column<string>(type: "text", nullable: false),
                    external_booking_id = table.Column<string>(type: "text", nullable: false),
                    received_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_handoff_affected_customers", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_handoff_affected_customers_disruption_id_external_booking_id",
                table: "handoff_affected_customers",
                columns: new[] { "disruption_id", "external_booking_id" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "handoff_affected_customers");
        }
    }
}
