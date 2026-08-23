using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TravelDisruptionAgent.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSystemSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "system_settings",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    unresolved_turn_threshold = table.Column<int>(type: "integer", nullable: false),
                    low_confidence_escalation_enabled = table.Column<bool>(type: "boolean", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_system_settings", x => x.id);
                });

            // 表永远只有一行，这里种子插入，应用代码不用判断"没有就创建"这种分支。
            migrationBuilder.Sql(
                "INSERT INTO system_settings (id, unresolved_turn_threshold, low_confidence_escalation_enabled, updated_at) " +
                "VALUES (gen_random_uuid(), 5, true, now());");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "system_settings");
        }
    }
}
