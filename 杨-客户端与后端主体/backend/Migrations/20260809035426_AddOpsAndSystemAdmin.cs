using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TravelDisruptionAgent.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddOpsAndSystemAdmin : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "must_change_password",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "alert_acknowledgements",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    alert_key = table.Column<string>(type: "text", nullable: false),
                    acknowledged_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    acknowledged_date = table.Column<DateOnly>(type: "date", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_alert_acknowledgements", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "user_status_audits",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    actor_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    action = table.Column<string>(type: "text", nullable: false),
                    reason = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_user_status_audits", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_alert_acknowledgements_alert_key_acknowledged_date",
                table: "alert_acknowledgements",
                columns: new[] { "alert_key", "acknowledged_date" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_user_status_audits_user_id",
                table: "user_status_audits",
                column: "user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "alert_acknowledgements");

            migrationBuilder.DropTable(
                name: "user_status_audits");

            migrationBuilder.DropColumn(
                name: "must_change_password",
                table: "users");
        }
    }
}
