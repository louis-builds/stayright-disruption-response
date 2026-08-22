using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TravelDisruptionAgent.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddMessageThread : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "thread",
                table: "messages",
                type: "text",
                nullable: false,
                defaultValue: "ai");

            // 历史数据里 sender_role='coordinator' 的那些原本躺在同一条时间线里，拆分后归到
            // coordinator 线程；其余(system/guest/ai)留在默认的 ai 线程，没法倒推历史 guest
            // 消息当时是想问 AI 还是找协调员，默认 ai 最不破坏现状。
            migrationBuilder.Sql(
                "UPDATE messages SET thread = 'coordinator' WHERE sender_role = 'coordinator';");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "thread",
                table: "messages");
        }
    }
}
