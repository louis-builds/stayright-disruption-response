using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TravelDisruptionAgent.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddOptionLocking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "locked",
                table: "options",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "unavailable_reason",
                table: "options",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "option_lock_audits",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    option_id = table.Column<Guid>(type: "uuid", nullable: false),
                    actor_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    action = table.Column<string>(type: "text", nullable: false),
                    reason = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_option_lock_audits", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_option_lock_audits_option_id",
                table: "option_lock_audits",
                column: "option_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "option_lock_audits");

            migrationBuilder.DropColumn(
                name: "locked",
                table: "options");

            migrationBuilder.DropColumn(
                name: "unavailable_reason",
                table: "options");
        }
    }
}
